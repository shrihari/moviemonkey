
import React from 'react'
import ReactDOM from 'react-dom'

export default class Statusbar extends React.Component {

  constructor(props) {
    super(props);
  }

  render() {
    var t = this;
    var mode = "";
    if (this.props.status.mode == 0)
      mode = "hide";
    else if(this.props.status.mode == 2)
      mode = "click"

    return (
	    <div id="statusbar" className={mode} onClick={this.props.onClick}>
        {this.props.status.message}
	    </div>
    );
  }
}