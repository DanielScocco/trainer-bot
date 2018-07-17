"use strict";

//Express.js
var express = require('express');
var app = express(); 

//Other Modules
var request = require('request');
var bodyParser = require('body-parser');
var MongoClient = require('mongodb').MongoClient;
var multer  = require('multer');
var storage = multer.memoryStorage();
var AWS = require('aws-sdk');
app.use(bodyParser.json());

//Connect to MongoDB
var db;
MongoClient.connect('mongodb://',function(err,database){
    if(err)
        throw err;
    db = database;    
});

//Messenger Webhook Integration
app.get('/',function(req,res) {
	if(req.query['hub.verify_token']==='secret')
		res.send(req.query['hub.challenge']);
	else
		res.send('Error');
});

//Messenger Webhook Integration
app.get('/submit',function(req,res) {	
	var content = `<html><head><title>Submit Exercise</title></head><body>
		<form method="POST" enctype="multipart/form-data" action="/saveQuestion">
		<label>Category</label><br>
			<input type="number" name="category">    <br> <br>

			<label>Type</label><br>
			<input type="number" name="type">    <br> <br>

			<label>Answer</label><br>
			<input type="number" step="0.01" name="answer">    <br> <br>


			<label>Image</label><br>
			<input type="file" name="fileToUpload">       <br> <br>
			<input type="submit" value="Save">
		</form>
		</body></html>`;
	
	res.status(200); 
	res.send(content);
});

//Messenger Webhook Integration
app.post('/saveQuestion', multer({ storage: storage }).single('fileToUpload'),function(req,res) {
	var s3  = new AWS.S3({
	  accessKeyId: '',
	  secretAccessKey: '',
	  region: 'us-west-1',
	});	
	
	if(req.file!=null){
   		if(req.file.mimetype=='image/png')
   			var imageName = makeid() + ".png";  
   		else if(req.file.mimetype=='image/jpeg')
   			var imageName = makeid() + ".jpg";
   		else if(req.file.mimetype=='image/gif')
   			var imageName = makeid() + ".gif";    	
   		else{
   			res.send("Unsuported format.");
   			return;
   		}
   	
   ''	//upload to AWS
   		var params = {
		  Key: imageName,
		  Bucket: "trainerbot",
		  Body: req.file.buffer,
		  ACL:'public-read',
		  ContentType: req.file.mimetype};

		  s3.putObject(params, function put(err, data) {
		  if (err) {
		    console.log(err, err.stack);
		    return;
		  } else {
		    console.log("AWS-upload="+data);
		  }	 
		});
	}
	else{
		var imageName = null;
	}

	var exercise = {};
	exercise.type = parseInt(req.body.type);
	exercise.answer = parseInt(req.body.answer);
	exercise.category = parseInt(req.body.category);
	exercise.imagePath = imageName;

	db.collection('exercises').save(exercise,function(err,result){
        		if(err) throw err;
	});
	
	res.redirect("/submit");
});

function makeid() {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < 30; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}

/* ---------------------- Code Begins Here --------------------------- */

//Synonyms Array - used by whichOption()
var syns = [];
syns['yes'] = ['positive','yeah'];
syns['no'] = ['negative'];

//POST requests
app.post('/',function(req,res){
	var data = req.body;

	//make sure it's a page subscription
	if(data.object == 'page'){
		//iterate over each entry
		data.entry.forEach(function(pageEntry){
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			//iterate over each mesaging event
			pageEntry.messaging.forEach(function(messagingEvent){
				if(messagingEvent.optin)
					receivedAuthentication(messagingEvent);
				else if(messagingEvent.message&&(!messagingEvent.message.attachments))
					receivedMessage(messagingEvent);
				else if(messagingEvent.delivery)
					receivedDeliveryConfirmation(messagingEvent);
				else if(messagingEvent.postback)
					receivedPostback(messagingEvent);
				else
					console.log("--> Unknown messagingEvent");
			});
		});

		res.sendStatus(200);
	}

});

//Updates the state of a user on DB
function updateState(user, value){
	db.collection('users').update({user_id:user},{$set:{state:value}},function(err,result){	
		if(err)	throw err;
	 });
}

//Ask the user if he wants to subscribe
function askSubscription(senderID, type){
	var answerType = 2;
	var quickReplies = [
		{
			content_type:"text",
			title:"Yes",
			payload:"none"
		},
		{
			content_type:"text",
			title:"No",
			payload:"none"
		}
	];
	var reply = "Hi! Would you like to receive one productivity and motivational tip every day?";
	if(type==2){
		reply = "Sorry, I didn't understand. Would you like to receive one productivity and motivational tip every day?";
	}

	sendTextMessage(senderID,answerType,reply,quickReplies);
}

//Confirm his choice with the user
function sendConfirmation(senderID, type){
	var answerType = 1;
	var reply = "You got it! Expect your first tip tomorrow morning. You can say 'stop' to halt your subscription if you want.";
	if(type==2){
		reply = "OK, I won't send you anything. If you change your mind, just talk to me again!";
	}

	sendTextMessage(senderID,answerType,reply,null);
}

//Normal text message event
function receivedMessage(event){
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;
	var messageText = message.text;
	console.log("--> receivedMessage()");

	//Check if user is on DB, if not, add it
	db.collection('users').find({user_id:senderID}).toArray(function (err,result){
		if(err) throw err;

		//Found user
		if(result.length){
			var state = result[0].state;
			if(state==1){
				//Check the user answer
	    		var options = ['yes','no'];
	    		var answer = whichOption(options,messageText);
	    		//Couldn't understand answer
	    		if(answer==0){
	    			askSubscription(senderID,2);
	    		}
	    		//YES, subscribe me
	    		else if(answer==1){
	    			sendConfirmation(senderID,1);
	    			updateState(senderID,0);
	    		}
	    		//NO, don't subscribe me
	    		else if(answer==2){
	    			sendConfirmation(senderID,2);
	    			updateState(senderID,0);
	    		}
			}
		}
		//User not found
		else{
			var user = {user_id:senderID,state:1,sub:0,tips_received:0};
			db.collection('users').save(user,function(err,result){
                		if(err) throw err;
			});			
			askSubscription(senderID,1);			
		}
	});

	var messageText = message.text;
	sendTextMessage(senderID,messageText);
}

function receivedDeliveryConfirmation(event){
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if(messageIDs){
		messageIDs.forEach(function(messageID){
			console.log("--> Delivery confirmation for message ID: %s",messageID);
		});
	}
	//console.log("All messages before %d were delivered.",watermark);
}

//Not being used - for users coming from websites
function receivedAuthentication(event){
	console.log("--> authentication event");
}

//Postback events
function receivedPostback(event) {
	console.log("--> postback event");
}

//Format the data in the request and send it
function sendTextMessage(senderID,answerType,reply,quickReplies){
	var messageData;
	//simple text message
	if(answerType==1){
		messageData = {
			recipient:{
				id:senderID
			},
			message:{
				text: reply
			}
		};
	}
	//text message with quick replies
	else if(answerType==2){
		messageData = {
			recipient:{
				id:senderID
			},
			message:{
				text: reply,
				quick_replies:quickReplies
			}
		};
	}
	//generic template message
	else if(answerType==3){
		var messageData = {
			recipient:{
				id:senderID
			},
			message:{
				attachment:{
					type:"template",
					payload:{
						template_type:"generic",
						elements:quickReplies
					}
				}
			}
		};
	}

	if(messageData!=null){
		callSendAPI(messageData);
	}
	else{
		console.log("--->Problem on sendTextMessage(): messageData==null");
	}
}

//call the Send API
function callSendAPI(messageData){
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {access_token:''},
		method: 'POST',
		json: messageData
	}, function(error,response,body){
		if(!error && response.statusCode == 200){
			console.log("-->Sent message!");
		}
		else{
			console.log("--> Unable to send message");
			console.error(response);
			console.error(error);
		}
	});
}

app.listen(process.env.PORT || 3000,function(){
	console.log("--> listening on 3000");
});

/* -------------------------- Auxiliary Functions ------------------------- */

//Minimum Edit Distance function
function minEditDistance(a, b){
    if(a.length == 0) return b.length;
    if(b.length == 0) return a.length;

    var matrix = [];

    // increment along the first column of each row
    var i;
    for(i = 0; i <= b.length; i++){
        matrix[i] = [i];
    }

    // increment each column in the first row
    var j;
    for(j = 0; j <= a.length; j++){
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for(i = 1; i <= b.length; i++){
        for(j = 1; j <= a.length; j++){
            if(b.charAt(i-1) == a.charAt(j-1)){
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                 matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                Math.min(matrix[i][j-1] + 1, // insertion
                                         matrix[i-1][j] + 1)); // deletion
            }   
        }
    }

    return matrix[b.length][a.length];
}

//substitutes special chars, remove hyphens, all to lowercase, etc
function cleanString(string){
	var newString = string.toLowerCase();
	newString = newString.replace(/  /g," ");
	newString = newString.replace(/   /g," ");
	newString = newString.replace(/-/g,"");
	newString = newString.replace(/ç/g,"c");
	newString = newString.replace(/ã/g,"a");
	newString = newString.replace(/á/g,"a");
	newString = newString.replace(/é/g,"e");
	newString = newString.replace(/í/g,"i");
	newString = newString.replace(/ó/g,"o");
	newString = newString.replace(/ú/g,"u");
	newString = newString.replace(/à/g,"a");
	newString = newString.replace(/è/g,"e");
	newString = newString.replace(/ì/g,"i");
	newString = newString.replace(/ò/g,"o");
	newString = newString.replace(/ù/g,"u");
	newString = newString.replace(/â/g,"a");
	newString = newString.replace(/ê/g,"e");
	newString = newString.replace(/î/g,"i");
	newString = newString.replace(/ô/g,"o");
	newString = newString.replace(/û/g,"u");
	newString = newString.replace(/!/g,"");
	newString = newString.replace(/#/g,"");

	return newString;	
}

//checks which option (all possibilities come in the array) the user meant with his sentence
//return value is 1 for first option, 2 for second, etc.... Returns 0 if not found any
function whichOption(arr,sentence){
    var n = arr.length;

    //no options provided
    if(n==0)
        return 0;

   	sentence = cleanString(sentence);
	var words = sentence.split(" ");	

	//------ special case with 2 options, one is substring of the other -------//
	if(n==2){
        var isSubstring;
        if(arr[0].length<arr[1].length)
            isSubstring = arr[1].indexOf(arr[0]);
        else
            isSubstring = arr[0].indexOf(arr[1]);

	//is substring
        if(isSubstring!=-1){
   	    	var returnArray = [1,2];
	    	//if needed, move shorter word to first element
	    	if(arr[0].length>arr[1].length){
		    	var placeholder = arr[0];
		    	arr[0] = arr[1];
		    	arr[1] = placeholder;

		    	//changed order or words internally, but not externally, so return values must be adjusted
		    	returnArray = [2,1];
	    	}

            var index = arr[1].indexOf(arr[0]);
            var difference;

            if(index==0)
                    difference = arr[1].substring(arr[0].length);
            else
                    difference = arr[1].substring(0,arr[1].length-arr[0].length);

            //search for longer word first
            for (let w of words){
                    if(minEditDistance(w,arr[1])<2)
                            return returnArray[1];
            }
            //search for 'difference' in sentence
            for(let w of words){
                    if(minEditDistance(w,difference)<2)
                            return returnArray[1];
            }
            //difference couldn't be found, so not word2, check for word1 now
            for(let w of words){
                    if(minEditDistance(w,arr[0])<2)
                            return returnArray[0];
            }
            //couldn't find either, return 0
            return 0;
   	    }
	}

    //------------- general case, search word by word --------------- //
    for(var i=0;i<n;i++){
        //create array with current word and its synonyms
        var stringsArray = [];
        var hadHyphen = [];
        //add main word
        hadHyphen[0] = arr[i].split('-').length - 1; //records the total number of hyphens on the word
        stringsArray[0] = arr[i].replace(/-/g,"");//remove hyphens if necessary
        //add synonyms
		var synonyms = syns[arr[i]];
		if(synonyms!=null){
			var nSyns = synonyms.length;
			for(var k=0;k<nSyns;k++){
				hadHyphen[k+1] = synonyms[k].split('-').length - 1; //count hyphens
				stringsArray[k+1] = synonyms[k].replace(/-/g,"");//remove hyphens
			}
		}
        //search each word (main+synonyms)
        var totalWords = stringsArray.length;
        for(var w=0;w<totalWords;w++){
            //if had hyphens, search for open compound first
            if(hadHyphen[w]){
            	var nHyphens = hadHyphen[w];
                var nWords = words.length;
                var combinedString;
                //close each pair of words in sentence, and compare with target string
                for(var j=0;j<(nWords-nHyphens);j++){
                	combinedString = words[j];
                	for(var t=0;t<nHyphens;t++){
                		combinedString += words[j+1+t];
                	}
                    if(minEditDistance(combinedString,stringsArray[w])<2)
                        return i+1;
                }
            }    
            //search normally on each word
		    for(let word of words){
	                if(minEditDistance(stringsArray[w],word)<2)
			    return i+1;
		    }
		}
    }   

	//couldn't find a match
	return 0;
}
